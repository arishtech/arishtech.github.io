<?php 
$restly_copyright_text = restly_options('restly_copyright_text');
$restly_footer_socials = restly_options('restly_footer_socials');
if(!empty($restly_footer_socials) ){
    $restly_col = 'col-lg-6 col-md-6 col-sm-12 col-12';
    $restly_tcenter = '';
}else{
    $restly_col = 'col-lg-12 col-md-12 col-sm-12 col-12';
    $restly_tcenter = 'text-center';
}
?>
<div class="copyright-area">
    <div class="container">
        <div class="row">
            <?php if(!empty($restly_footer_socials) ) : ?>
            <div class="col-lg-6 col-md-6 col-sm-12 col-12">
                <div class="social-icons">
                    <ul>
                    <?php 
                        foreach( $restly_footer_socials as $restly_ft_social ){
                            echo '<li><a href="'.esc_url($restly_ft_social['restly_ft_social_link']).'" title="'.esc_attr($restly_ft_social['restly_ft_social_label']).'"><i class="'.esc_attr($restly_ft_social['restly_ft_social_icon']).'"></i></a></li>';
                        }
                    ?>
                    </ul>
                </div>
            </div>
            <?php endif; ?>
            <div class="<?php echo esc_attr($restly_col); ?>">
                <div class="site-info <?php echo esc_attr($restly_tcenter); ?>">
                    <?php echo wp_kses($restly_copyright_text,'restly_allowed_html'); ?>
                </div><!-- .site-info -->
            </div>
        </div>
    </div>
</div>