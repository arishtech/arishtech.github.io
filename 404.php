<?php
/**
 * The template for displaying 404 pages (not found)
 *
 * @link https://codex.wordpress.org/Creating_an_Error_404_Page
 *
 * @package Restly
 */

get_header();
$restly_error_page_banner = restly_options('restly_error_page_banner', true);
$restly_error_page_title = restly_options('restly_error_page_title');
$restly_error_image = restly_options('restly_error_image');
$restly_not_found_text = restly_options('restly_not_found_text');
$restly_go_back_home = restly_options('restly_go_back_home', true );
$restly_error_page_button_text = restly_options('restly_error_page_button_text', esc_html('Go Back','restly') );
?>
<?php if($restly_error_page_banner == true ) : ?>
	<div class="breadcroumb-area">
		<div class="container">
			<div class="breadcroumn-contnt">
				<h2>
				<?php 
				if(!empty($restly_error_page_title)){
					echo esc_html($restly_error_page_title);
				}
				?>
				</h2>
				<div class="bre-sub">
				<?php if(function_exists('bcn_display')){
					bcn_display();
				}?>
				</div>
			</div>
		</div>
	</div>
<?php endif; ?>
	<main id="primary" class="site-main">
		<div class="container error-404 not-found">
			<div class="row justify-content-center">
				<div class="col-12 col-sm-12 col-md-10 col-xl-8 col-lg-8">
					<div class="page-content">
						<?php if(!empty($restly_error_image['url'])) : ?>
						<div class="error-image">
							<img src="<?php echo esc_url($restly_error_image['url']); ?>" alt="<?php echo esc_attr($restly_error_image['alt']) ?>">
						</div>
						<?php endif; ?>
						<div class="error-dec">
							<?php echo wp_kses($restly_not_found_text,'restly_allowed_html'); ?>
						</div>
						<?php if( $restly_go_back_home == true ) : ?>
							<div class="error-button">
							<a class="theme-btns" href="<?php echo esc_url(home_url('/')); ?>"><?php echo esc_html($restly_error_page_button_text); ?></a>
							</div>
						<?php endif; ?>
					</div><!-- .page-content -->
				</div>
			</div>
		</div>
	</main><!-- #main -->

<?php
get_footer();
