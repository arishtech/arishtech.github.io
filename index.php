<?php
/**
 * The main template file
 *
 * This is the most generic template file in a WordPress theme
 * and one of the two required files for a theme (the other being style.css).
 * It is used to display a page when nothing more specific matches a query.
 * E.g., it puts together the home page when no home.php file exists.
 *
 * @link https://developer.wordpress.org/themes/basics/template-hierarchy/
 *
 * @package Restly
 */

get_header();
$restly_blogc_title      = restly_options( 'restly_blog_title' );
$restly_banner_enable    = restly_options( 'restly_blog_banner_enable', true );
$restly_blog_layout      = restly_options( 'restly_blog_layout', 'right-sidebar' );
if($restly_blog_layout == 'grid'){
	$restly_sidebar_bg = 'sidebar-no-bg-main';
}else{
	$restly_sidebar_bg = 'sidebar-bg-main';
}
?>
<?php if ( $restly_banner_enable == true ) : ?>
<div class="breadcroumb-area">
	<div class="container">
		<div class="breadcroumn-contnt">
			<h2><?php echo esc_html( $restly_blogc_title ); ?></h2>
			<div class="bre-sub">
				<span><a href="<?php echo esc_url( home_url( '/' ) ); ?>"><?php esc_html_e('Restly','restly') ?></a> <i class="fas fa-minus"></i></span>
				<span><span><?php esc_html_e('Blog Standard','restly'); ?></span></span>
			</div>
		</div>
	</div>
</div>
<?php endif;?>
<main id="primary" class="site-main content-area  <?php echo esc_attr($restly_sidebar_bg); ?>">
	<div class="container page-layout <?php echo esc_attr($restly_blog_layout); ?>">
		<?php
            if ( $restly_blog_layout == 'grid' ) {
                get_template_part( 'template-parts/blog/post-grid' );
            } else {
                get_template_part( 'template-parts/blog/post-sidebar' );
            }?>
	</div>
</main><!-- #main -->
<?php
get_footer();
