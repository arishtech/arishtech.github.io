<?php
/**
 * The template for displaying all portfolio single posts
 *
 * @link https://developer.wordpress.org/themes/basics/template-hierarchy/#single-post
 *
 * @package Restly
 */

get_header();
if(get_post_meta( get_the_ID(), 'restly_metabox', true)) {
    $restly_commonMeta = get_post_meta( get_the_ID(), 'restly_metabox', true );
} else {
    $restly_commonMeta = array();
}
$restly_portfolio_nav = restly_options('restly_portfolio_nav', true);
$restly_portfolio_related = restly_options('restly_portfolio_related', true);
$restly_portfolio_related_title = restly_options('restly_portfolio_related_title');
$restly_portfolio_banner_enable = restly_options('restly_portfolio_banner_enable');
if(array_key_exists('restly_layout_meta', $restly_commonMeta) && !empty($restly_commonMeta['restly_layout_meta'])){
    $restly_portfolio_Layout = $restly_commonMeta['restly_layout_meta'];
}else{
    $restly_portfolio_Layout = 'full-width';
}
if(is_array($restly_commonMeta) && array_key_exists('restly_sidebar_meta', $restly_commonMeta)){
    $restly_selectedSidebar = $restly_commonMeta['restly_sidebar_meta'];
}else{
    $restly_selectedSidebar = 'sidebar';
}

if($restly_portfolio_Layout == 'left-sidebar' && is_active_sidebar($restly_selectedSidebar) || $restly_portfolio_Layout == 'right-sidebar' && is_active_sidebar($restly_selectedSidebar)){
    $restly_portfolioColumnClass = 'col-12 col-sm-12 col-md-12 col-lg-7 col-xl-8';
}else{
    $restly_portfolioColumnClass = 'col-12 col-sm-12 col-md-12 col-lg-12 col-xl-12';
}

if($restly_portfolio_banner_enable == false ){
    $restly_portfolio_post_Banner = false;
}elseif(array_key_exists('restly_meta_enable_banner', $restly_commonMeta)){
    $restly_portfolio_post_Banner = $restly_commonMeta['restly_meta_enable_banner'];
}else{
    $restly_portfolio_post_Banner = true;
}

if($restly_portfolio_Layout == 'full-width'){
	$restly_sidebar_bg = 'sidebar-no-bg-main';
}else{
	$restly_sidebar_bg = 'sidebar-bg-main';
}
?>
	<?php if($restly_portfolio_post_Banner == true ) : ?>
	<div class="breadcroumb-area">
		<div class="container">
			<div class="breadcroumn-contnt">
				<h2><?php the_title(); ?></h2>
				<div class="bre-sub">
				<?php if(function_exists('bcn_display')){
					bcn_display();
				}?>
				</div>
			</div>
		</div>
	</div>
	<?php endif; ?>
	<main id="primary" class="site-main content-area <?php echo esc_attr($restly_sidebar_bg); ?>">
		<div class="container">
			<div class="page-layout <?php echo esc_attr($restly_portfolio_Layout); ?>">
				<div class="row">
					<?php
					if($restly_portfolio_Layout == 'left-sidebar' && is_active_sidebar($restly_selectedSidebar)){
						get_sidebar();
					}
					?>
					<div class="<?php echo esc_attr($restly_portfolioColumnClass); ?>">
						<div class="all-posts-wrapper">
						<?php
							while ( have_posts() ) :
								the_post();
								the_content();
							endwhile; // End of the loop.
							?>
						</div>
						<?php if($restly_portfolio_related == true ) : ?>
						<div class="restly-portfolio-related-wrapper">
							<div class="restly-portfolios-wrapper">
								<div class="restly-portfolio-inner">
									<div class="restly-portfolio-three">
										<?php 
										$restly_related_texonomy = wp_get_object_terms( $post->ID, 'restly_portfolio_cat', array('fields' => 'ids') );
										//query arguments
										$args = array(
											'post_type' => 'restly_portfolio',
											'post_status' => 'publish',
											'posts_per_page' => 3,
											'orderby' => 'rand',
											'tax_query' => array(
												array(
													'taxonomy' => 'restly_portfolio_cat',
													'field' => 'id',
													'terms' => $restly_related_texonomy
												)
											),
											'post__not_in' => array ($post->ID),
										);
										//the query
										$restly_PrelatedPosts = new WP_Query( $args );
										?>
										<div class="restly-portfolio-three-content">
												<?php if($restly_PrelatedPosts->have_posts() && $restly_portfolio_related == true ){
												echo '<h2 class="restly-related-portfolio-title">'.esc_html($restly_portfolio_related_title).'</h2>';
											} ?>
											<div class="row clearfix" id="related-portfolio-slide">
												<?php 
												if($restly_PrelatedPosts->have_posts()) :
												while($restly_PrelatedPosts->have_posts()) : $restly_PrelatedPosts->the_post();
												?>
												<div class="item col-12 col-sm-6 col-md-6 col-lg-4">
													<div class="restly-portfolio-item">
														<?php the_post_thumbnail('restly-portfolio-medium', array('class' => 'img-responsive portfolio-three-image'), true); ?> 
														<div class="restly-portfolio-dec">
															<h6><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h6>
														</div>
													</div>
												</div>
												<?php endwhile; wp_reset_postdata(); endif; ?>
											</div>
										</div>
									</div>
								</div>
							</div>
						</div>
						<?php endif; ?>
					</div>
					<?php
                    if($restly_portfolio_Layout == 'right-sidebar' && is_active_sidebar($restly_selectedSidebar)){
                        get_sidebar();
                    }?>
				</div>
			</div>
		</div>
	</main><!-- #main -->
<?php
get_footer();